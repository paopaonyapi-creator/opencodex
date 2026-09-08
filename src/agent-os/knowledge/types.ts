// Phase 21 — Pao Knowledge Layer Domain Types (spec sections 8, 10, 11, 12, 16, 45).
//
// Canonical types for Knowledge Documents, Sections, Queries, Grounded Search Results,
// Claim Verification, Evidence Packs, Risk Levels, Phase Relations, and Providers.

export type KnowledgeDocType =
  | "phase"
  | "architecture"
  | "decision"
  | "specification"
  | "research"
  | "operation"
  | "integration"
  | "general";

export interface KnowledgeDocument {
  id: string;
  type: KnowledgeDocType;
  title: string;
  path: string;
  hash: string;
  version: number;
  status: "active" | "deprecated" | "superseded" | "draft";
  sourcePriority: number; // 0..100 (Code=100, ADR=95, Arch=90, Phase=80, etc.)
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  indexedAt: string;
}

export interface KnowledgeSection {
  id: string;
  documentId: string;
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
  contentHash: string;
}

export interface KnowledgeQuery {
  query: string;
  types?: KnowledgeDocType[];
  phases?: string[];
  sources?: string[];
  limit?: number;
}

export interface SearchResult {
  documentId: string;
  title: string;
  type: KnowledgeDocType;
  path: string;
  section: string;
  snippet: string;
  score: number; // 0..1
  provider: string;
  sourcePriority: number;
}

export interface GroundedSearchResult {
  query: string;
  results: SearchResult[];
  totalFound: number;
  providersUsed: string[];
  durationMs: number;
}

export type ClaimVerificationStatus =
  | "supported"
  | "partially_supported"
  | "contradicted"
  | "insufficient_evidence";

export interface ClaimVerification {
  claim: string;
  status: ClaimVerificationStatus;
  confidence: number; // 0..1
  evidence: {
    documentId: string;
    title: string;
    section: string;
    snippet: string;
    path: string;
  }[];
  conflicts: {
    documentId: string;
    claim: string;
    opposingStatement: string;
  }[];
  reasoning: string;
}

export type TaskRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface AgentTask {
  id?: string;
  title: string;
  description?: string;
  targetComponents?: string[];
  targetFiles?: string[];
  riskLevel?: TaskRiskLevel;
}

export interface EvidencePack {
  taskId: string;
  task: string;
  riskLevel: TaskRiskLevel;
  sources: {
    documentId: string;
    path: string;
    section: string;
    confidence: number;
  }[];
  relatedComponents: string[];
  architectureDecisions: string[];
  conflicts: string[];
  unknowns: string[];
  recommendation: string;
  allowedToProceed: boolean;
  blockReason?: string;
}

export type PhaseRelationType =
  | "depends_on"
  | "extends"
  | "supersedes"
  | "conflicts_with"
  | "related_to"
  | "implements";

export interface PhaseRelation {
  id: string;
  sourcePhase: string;
  targetPhase: string;
  relationType: PhaseRelationType;
  confidence: number;
  evidenceDocumentId?: string | null;
  createdAt: string;
}

export interface PhaseComparison {
  phaseA: string;
  phaseB: string;
  sharedComponents: string[];
  relations: PhaseRelation[];
  conflicts: string[];
  supersededItems: string[];
  newItems: string[];
}

export interface DependencyGraph {
  target: string;
  dependencies: {
    phase: string;
    relationType: PhaseRelationType;
    confidence: number;
    evidenceId?: string;
  }[];
  dependents: {
    phase: string;
    relationType: PhaseRelationType;
  }[];
}

export interface ProviderHealth {
  provider: string;
  status: "healthy" | "degraded" | "unavailable";
  latencyMs: number;
  documentCount: number;
  error?: string;
}

export type KnowledgeErrorCode =
  | "KNOWLEDGE_NOT_FOUND"
  | "KNOWLEDGE_CONFLICT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "SOURCE_BLOCKED"
  | "SENSITIVE_CONTENT"
  | "INDEX_STALE"
  | "CLAIM_UNVERIFIED"
  | "EVIDENCE_INSUFFICIENT";

export interface KnowledgeAuditEvent {
  id: string;
  agent: string;
  action: string;
  query: string;
  sources: string[];
  result: string;
  errorCode?: KnowledgeErrorCode;
  createdAt: string;
}
