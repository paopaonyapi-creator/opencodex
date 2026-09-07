// Phase 20.5 — Pao Living Knowledge Brain × LLM Wiki × Persistent Knowledge Graph
// Types & Domain Models

export type SourceType =
  | "PROJECT_FILE"
  | "MARKDOWN"
  | "TEXT"
  | "PDF"
  | "DOCX"
  | "JSON"
  | "YAML"
  | "CSV"
  | "LOG"
  | "GIT_COMMIT"
  | "GIT_DIFF"
  | "GITHUB_METADATA"
  | "SESSION_LOG"
  | "AGENT_RUN"
  | "REVIEW"
  | "ISSUE"
  | "DECISION"
  | "PHASE_SPEC"
  | "DESKTOP_EVIDENCE"
  | "WEB_SNAPSHOT"
  | "MANUAL_NOTE";

export type IngestionState =
  | "DISCOVERED"
  | "QUEUED"
  | "PARSING"
  | "NORMALIZING"
  | "EXTRACTING"
  | "COMPILED"
  | "INDEXED"
  | "FAILED"
  | "QUARANTINED"
  | "DELETED"
  | "NEW"
  | "UNCHANGED"
  | "UPDATED"
  | "EXCLUDED";

export type SourceTrust =
  | "OFFICIAL"
  | "PRIMARY"
  | "INTERNAL"
  | "COMMUNITY"
  | "UNVERIFIED";

export interface KnowledgeSource {
  id: string;
  sourceType: SourceType;
  title: string;
  uriOrPath: string;
  projectId?: string | null;
  owner: string;
  accessScope: "public" | "internal" | "restricted" | "secret";
  enabled: boolean;
  canonicality: "canonical" | "derived" | "unverified";
  fingerprint: string;
  status: IngestionState;
  lastIngestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SourceVersion {
  id: string;
  sourceId: string;
  versionNumber: number;
  contentHash: string;
  sizeBytes: number;
  parserVersion: string;
  status: string;
  modifiedAt?: string | null;
  ingestedAt: string;
  metadata: Record<string, unknown>;
}

export interface SourceChunk {
  id: string;
  sourceVersionId: string;
  chunkIndex: number;
  sectionPath: string;
  startOffset: number;
  endOffset: number;
  lineStart?: number | null;
  lineEnd?: number | null;
  page?: number | null;
  contentHash: string;
  text: string;
  metadata: Record<string, unknown>;
  heading?: string;
  chunk_sha256?: string;
  start_line?: number | null;
  end_line?: number | null;
}

export type EntityType =
  | "PROJECT"
  | "PHASE"
  | "FEATURE"
  | "MODULE"
  | "SERVICE"
  | "AGENT"
  | "MODEL"
  | "TOOL"
  | "MCP_TOOL"
  | "WORKFLOW"
  | "PROVIDER"
  | "TECHNOLOGY"
  | "DATABASE"
  | "API"
  | "FILE"
  | "DECISION"
  | "ISSUE"
  | "ERROR"
  | "SOLUTION"
  | "PERSON_OR_ORG_REFERENCE"
  | "DOCUMENT"
  | "REPOSITORY"
  | "SUBSYSTEM"
  | "CONCEPT"
  | (string & {});

export interface KnowledgeEntity {
  id: string;
  entityType: EntityType;
  canonicalName: string;
  aliases: string[];
  description: string;
  projectId?: string | null;
  status: "active" | "archived" | "superseded";
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  canonical_name?: string;
  kind?: string;
  summary?: string;
  slug?: string;
}

export type ClaimType =
  | "FACT"
  | "DECISION"
  | "REQUIREMENT"
  | "CAPABILITY"
  | "CONFIGURATION"
  | "STATUS"
  | "DEPENDENCY"
  | "OWNERSHIP"
  | "LIMITATION"
  | "RECOMMENDATION"
  | "HISTORICAL";

export type ClaimStatus =
  | "ACTIVE"
  | "SUPERSEDED"
  | "DISPUTED"
  | "STALE"
  | "RETRACTED"
  | "UNVERIFIED";

export interface KnowledgeClaim {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectValue: string;
  claimType: ClaimType;
  status: ClaimStatus;
  confidence: number;
  sourcePriority: number;
  validFrom?: string | null;
  validTo?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  provenance?: ClaimProvenance[] & { source_title?: string; chunk_heading?: string };
}

export interface ClaimProvenance {
  id: string;
  claimId: string;
  sourceVersionId: string;
  chunkId?: string | null;
  anchor: string;
  extractor: string;
  extractedAt: string;
  source_title?: string;
  chunk_heading?: string;
}

export type RelationType =
  | "DEPENDS_ON"
  | "IMPLEMENTS"
  | "EXTENDS"
  | "REPLACES"
  | "SUPERSEDES"
  | "USES"
  | "PROVIDES"
  | "OWNED_BY"
  | "RELATED_TO"
  | "GENERATES"
  | "REVIEWS"
  | "FIXES"
  | "CAUSES"
  | "BLOCKS"
  | "REQUIRES"
  | "PART_OF"
  | "CONTRADICTS"
  | (string & {});

export interface KnowledgeRelation {
  id: string;
  fromEntityId: string;
  relationType: RelationType;
  toEntityId: string;
  sourceClaimIds: string[];
  validFrom?: string | null;
  validTo?: string | null;
  status: "ACTIVE" | "SUPERSEDED" | "HISTORICAL";
  createdAt: string;
  metadata: Record<string, unknown>;
}

export type DecisionStatus =
  | "PROPOSED"
  | "ACCEPTED"
  | "RATIFIED"
  | "SUPERSEDED"
  | "REJECTED"
  | "REVERSED";

export interface KnowledgeDecision {
  id: string;
  title: string;
  status: DecisionStatus;
  decision: string;
  rationaleSummary: string;
  alternatives: string[];
  effectiveAt: string;
  supersedesId?: string | null;
  sourceRefs: string[];
  createdAt: string;
}

export type ContradictionStatus =
  | "OPEN"
  | "AUTO_RESOLVED"
  | "NEEDS_REVIEW"
  | "RESOLVED"
  | "IGNORED_WITH_REASON";

export interface ContradictionCase {
  id: string;
  subject: string;
  topic?: string;
  predicate: string;
  claimIds: string[];
  status: ContradictionStatus;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  detectedAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
  canonicalClaimId?: string | null;
  metadata: Record<string, unknown>;
}

export type WikiPageType =
  | "PROJECT"
  | "PHASE"
  | "TECHNOLOGY"
  | "WORKFLOW"
  | "DECISION"
  | "TOOL"
  | "ISSUE"
  | "SOLUTION"
  | "CONCEPT"
  | "TIMELINE"
  | "INDEX";

export type WikiPageStatus =
  | "CURRENT"
  | "STALE"
  | "NEEDS_EVIDENCE"
  | "DISPUTED"
  | "ARCHIVED"
  | "DRAFT";

export interface WikiPage {
  id: string;
  slug: string;
  title: string;
  pageType: WikiPageType;
  canonicalEntityId?: string | null;
  status: WikiPageStatus;
  currentRevisionId?: string | null;
  storagePath?: string | null;
  filePath?: string | null;
  file_path?: string | null;
  isHumanCurated?: boolean;
  is_human_curated?: number | boolean;
  content?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface WikiRevision {
  id: string;
  pageId: string;
  revisionNumber: number;
  contentHash: string;
  markdown: string;
  compilerVersion: string;
  sourceSetHash: string;
  summary: string;
  createdAt: string;
}

export interface QueryEvidence {
  id: string;
  query: string;
  selectedPages: Array<{ id: string; slug: string; title: string }>;
  selectedClaims: Array<{ id: string; predicate: string; objectValue: string; status: string }>;
  sourceVersions: Array<{ sourceId: string; versionId: string; uriOrPath: string }>;
  confidence: number;
  contradictions: Array<{ caseId: string; subject: string; resolution?: string | null }>;
  queriedAt: string;
}

export interface BrainHealth {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "REBUILDING";
  healthScore: number;
  sourcesTotal: number;
  sourcesFresh: number;
  sourcesStale: number;
  wikiPagesTotal: number;
  wikiPagesCurrent: number;
  wikiPagesStale: number;
  claimsTotal: number;
  claimsActive: number;
  entitiesTotal: number;
  relationsTotal: number;
  openContradictions: number;
  resolvedContradictions: number;
  brokenWikiLinks: number;
  activeClaimsWithoutSource: number;
  localOnly: boolean;
  components: {
    sourceRegistry: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    ingest: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    compiler: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    wiki: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    search: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    graph: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
    query: "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
  };
}
