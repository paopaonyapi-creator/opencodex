// Phase 20.5 — WebMCP Tools Definitions

import { getClaim, listClaims } from "./claims";
import { compareEntities } from "./compare";
import { detectContradictions, listContradictions, resolveContradiction } from "./contradictions";
import { getEntity, listEntities, resolveEntity } from "./entities";
import { getBrainHealthStatus, runKnowledgeLint } from "./lint";
import { queryKnowledgeBrain } from "./query-planner";
import { rebuildKnowledgeBrain } from "./rebuild";
import { listRelations } from "./relations";
import { searchBrain } from "./search";
import { createSourceVersion, getSource, registerSource } from "./sources";
import { compileWikiPage } from "./wiki-compiler";
import { getWikiPage, listWikiPages, listWikiRevisions } from "./wiki-storage";

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  riskTier: "R0" | "R1" | "R2" | "R3" | "R4";
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export const BRAIN_MCP_TOOLS: WebMcpToolDefinition[] = [
  {
    name: "brain_search",
    description: "Search Pao Living Knowledge Brain across Wiki pages, claims, entities, and sources.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => searchBrain(String(args.query ?? ""), Number(args.limit ?? 20)),
  },
  {
    name: "brain_query",
    description: "Ask Pao Living Knowledge Brain a question with provenance citations, evidence, and confidence score.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => queryKnowledgeBrain(String(args.question ?? "")),
  },
  {
    name: "brain_get_page",
    description: "Retrieve a Living Markdown Wiki page by its slug or ID.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => getWikiPage(String(args.slug ?? args.id ?? "")),
  },
  {
    name: "brain_get_page_history",
    description: "Retrieve revision history for a Living Markdown Wiki page.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => listWikiRevisions(String(args.pageId ?? "")),
  },
  {
    name: "brain_get_entity",
    description: "Retrieve canonical knowledge entity by name, alias, or ID.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => resolveEntity(String(args.name ?? args.id ?? "")),
  },
  {
    name: "brain_get_claims",
    description: "Retrieve claims for a subject entity with provenance details.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => listClaims({
      subjectEntityId: args.subjectEntityId ? String(args.subjectEntityId) : undefined,
      predicate: args.predicate ? String(args.predicate) : undefined,
      status: args.status as never,
    }),
  },
  {
    name: "brain_get_relations",
    description: "Retrieve relations between entities in the knowledge graph.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => listRelations({
      fromEntityId: args.fromEntityId ? String(args.fromEntityId) : undefined,
      toEntityId: args.toEntityId ? String(args.toEntityId) : undefined,
      relationType: args.relationType as never,
    }),
  },
  {
    name: "brain_ingest_source",
    description: "Register and ingest a new text or file source into the Knowledge Brain.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => {
      const src = registerSource({
        sourceType: (args.sourceType as never) ?? "MANUAL_NOTE",
        title: String(args.title ?? "Manual Ingest"),
        uriOrPath: String(args.uriOrPath ?? "manual/note.md"),
        projectId: args.projectId ? String(args.projectId) : null,
      });
      if (args.content) {
        createSourceVersion({
          sourceId: src.id,
          content: String(args.content),
        });
      }
      return getSource(src.id);
    },
  },
  {
    name: "brain_compile_page",
    description: "Trigger Living Markdown Wiki compilation for a given slug.",
    riskTier: "R1",
    readOnly: false,
    execute: (args) => compileWikiPage({
      slug: String(args.slug),
      title: String(args.title ?? args.slug),
      pageType: (args.pageType as never) ?? "CONCEPT",
      canonicalEntityId: args.canonicalEntityId ? String(args.canonicalEntityId) : null,
      humanNotes: args.humanNotes ? String(args.humanNotes) : undefined,
    }),
  },
  {
    name: "brain_compare",
    description: "Compare two entities or phases to detect overlaps, differences, and recommendations.",
    riskTier: "R0",
    readOnly: true,
    execute: (args) => compareEntities(String(args.entityA), String(args.entityB)),
  },
  {
    name: "brain_find_contradictions",
    description: "Scan active claims to detect contradictions and return open contradiction cases.",
    riskTier: "R0",
    readOnly: true,
    execute: () => ({
      detected: detectContradictions(),
      cases: listContradictions(),
    }),
  },
  {
    name: "brain_resolve_contradiction",
    description: "Resolve an open contradiction case by selecting the canonical claim.",
    riskTier: "R2",
    readOnly: false,
    execute: (args) => resolveContradiction({
      caseId: String(args.caseId),
      chosenClaimId: String(args.chosenClaimId),
      resolution: String(args.resolution),
      decidedBy: String(args.decidedBy ?? "mcp-operator"),
    }),
  },
  {
    name: "brain_lint",
    description: "Run Knowledge Base Linter and return health score, broken links, and missing provenance.",
    riskTier: "R0",
    readOnly: true,
    execute: () => runKnowledgeLint(),
  },
  {
    name: "brain_rebuild_search",
    description: "Trigger rebuild of Living Knowledge Brain indexes.",
    riskTier: "R2",
    readOnly: false,
    execute: () => rebuildKnowledgeBrain(),
  },
  {
    name: "brain_get_health",
    description: "Get overall Knowledge Brain health status and subsystem scorecard.",
    riskTier: "R0",
    readOnly: true,
    execute: () => getBrainHealthStatus(),
  },
];
